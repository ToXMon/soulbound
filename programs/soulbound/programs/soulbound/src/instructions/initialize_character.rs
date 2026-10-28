use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::associated_token::{self, AssociatedToken, Create};
use anchor_spl::token_2022::spl_token_2022::{extension::ExtensionType, state::Mint};
use anchor_spl::token_2022::{self, MintTo, SetAuthority, Token2022};
use anchor_spl::token_2022_extensions::{non_transferable_mint_initialize, NonTransferableMintInitialize};
use mpl_core::instructions::CreateV1Builder;
use mpl_core::types::{Attribute, Attributes, Plugin, PluginAuthorityPair};

use crate::error::SoulboundError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(character_id: u64)]
pub struct InitializeCharacter<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    // REQ-01 / REQ-06: canonical PDA; `init` fails if this (owner, id) already exists.
    #[account(
        init,
        payer = owner,
        space = 8 + CharacterConfig::INIT_SPACE,
        seeds = [CHARACTER_SEED, owner.key().as_ref(), &character_id.to_le_bytes()],
        bump
    )]
    pub config: Account<'info, CharacterConfig>,

    /// New Core asset keypair (signs its own creation).
    #[account(mut)]
    pub asset: Signer<'info>,

    /// New Token-2022 receipt mint keypair.
    #[account(mut)]
    pub receipt_mint: Signer<'info>,

    /// CHECK: created by the associated-token program inside this instruction.
    #[account(mut)]
    pub owner_receipt_ata: UncheckedAccount<'info>,

    /// CHECK: pinned to the Metaplex Core program id.
    #[account(address = mpl_core::ID)]
    pub core_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: Context<InitializeCharacter>,
    character_id: u64,
    runtime_signer: Pubkey,
    trait_vector: String,
) -> Result<()> {
    require!(
        trait_vector.len() <= MAX_TRAIT_VECTOR_LEN,
        SoulboundError::TraitVectorTooLong
    );

    let owner_key = ctx.accounts.owner.key();
    let bump = ctx.bumps.config;

    // REQ-07: config state.
    let cfg = &mut ctx.accounts.config;
    cfg.owner = owner_key;
    cfg.character_id = character_id;
    cfg.runtime_signer = runtime_signer;
    cfg.asset = ctx.accounts.asset.key();
    cfg.receipt_mint = ctx.accounts.receipt_mint.key();
    cfg.memory_epoch = 0;
    cfg.life_stage = LifeStage::Born;
    cfg.bump = bump;
    let life_stage = cfg.life_stage.as_str();

    let id_bytes = character_id.to_le_bytes();
    let seeds: &[&[u8]] = &[CHARACTER_SEED, owner_key.as_ref(), &id_bytes, &[bump]];
    let signer_seeds = &[seeds];

    // REQ-05: Token-2022 receipt. NonTransferable MUST be initialized before InitializeMint.
    let space = ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::NonTransferable])
        .map_err(|_| error!(SoulboundError::MathOverflow))?;
    let lamports = Rent::get()?.minimum_balance(space);
    create_account(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            CreateAccount {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.receipt_mint.to_account_info(),
            },
        ),
        lamports,
        space as u64,
        &ctx.accounts.token_program.key(),
    )?;
    non_transferable_mint_initialize(CpiContext::new(
        ctx.accounts.token_program.key(),
        NonTransferableMintInitialize {
            token_program_id: ctx.accounts.token_program.to_account_info(),
            mint: ctx.accounts.receipt_mint.to_account_info(),
        },
    ))?;
    token_2022::initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            token_2022::InitializeMint2 { mint: ctx.accounts.receipt_mint.to_account_info() },
        ),
        0,
        &ctx.accounts.config.key(),
        None,
    )?;
    associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.key(),
        Create {
            payer: ctx.accounts.owner.to_account_info(),
            associated_token: ctx.accounts.owner_receipt_ata.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
            mint: ctx.accounts.receipt_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.receipt_mint.to_account_info(),
                to: ctx.accounts.owner_receipt_ata.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;
    // Exactly one receipt ever: drop the mint authority.
    token_2022::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            SetAuthority {
                current_authority: ctx.accounts.config.to_account_info(),
                account_or_mint: ctx.accounts.receipt_mint.to_account_info(),
            },
            signer_seeds,
        ),
        anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType::MintTokens,
        None,
    )?;

    // REQ-02 / REQ-03: Core asset with genesis Attributes; config PDA is update authority.
    let attr = |k: &str, v: &str| Attribute { key: k.to_string(), value: v.to_string() };
    let attributes = Attributes {
        attribute_list: vec![
            attr("life_stage", life_stage),
            attr("mood", "curious"),
            attr("memory_epoch", "0"),
            attr("trait_vector", &trait_vector),
        ],
    };
    let ix = CreateV1Builder::new()
        .asset(ctx.accounts.asset.key())
        .payer(owner_key)
        .owner(Some(owner_key))
        .update_authority(Some(ctx.accounts.config.key()))
        .system_program(ctx.accounts.system_program.key())
        .name(CHARACTER_NAME.to_string())
        .uri(String::new())
        .plugins(vec![PluginAuthorityPair {
            plugin: Plugin::Attributes(attributes),
            authority: None,
        }])
        .instruction();
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.asset.to_account_info(),
            ctx.accounts.config.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.core_program.to_account_info(),
        ],
    )?;
    Ok(())
}
