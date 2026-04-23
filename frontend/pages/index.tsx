import Head from "next/head";

export default function HomePage() {
  return (
    <>
      <Head>
        <title>Diesel Dashboard</title>
        <meta
          name="description"
          content="Frontend shell for the Hemut Diesel dashboard."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="shell">
        <div className="shell__card">
          <p className="shell__eyebrow">Diesel Dashboard</p>
          <h1>Frontend shell is ready.</h1>
        </div>
      </main>
    </>
  );
}
