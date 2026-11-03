import { notFound } from "next/navigation";

/** The development branch (and its synthetic audio module) is eliminated from
 * production bundles. Production requests receive a real 404, not a fixture UI. */
export default async function PortraitCheckPage() {
  if (process.env.NODE_ENV === "development") {
    const { default: Fixture } = await import("@/components/living-portrait/fixture");
    return <Fixture />;
  }
  notFound();
}
