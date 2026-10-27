import Link from "next/link";

const NAME = process.env.NEXT_PUBLIC_APP_NAME || "Digital Product Studio";

const agents = [
  ["🔍", "Research Agent", "Finds expert frameworks and shapes the 12-chapter arc"],
  ["✍️", "Writer Agent", "Writes the full book, chapter by chapter, with one continuous story"],
  ["📘", "Publisher Agent", "Builds a styled, editable Word (.docx) manuscript"],
  ["🏗️", "Landing Page Agent", "Creates a self-contained, mobile-friendly sales page (HTML)"],
  ["📣", "Marketing Agent", "Designs a Meta/Instagram ad strategy with 5 hooks"],
  ["💰", "Sales Agent", "Pricing, payments, email sequence and launch playbook"],
  ["✅", "QA Agent", "Checks completeness and fixes gaps before hand-off"],
] as const;

export default function Landing() {
  return (
    <>
      <div className="container">
        <nav className="nav">
          <Link href="/" className="logo">
            {NAME.split(" ")[0]} <b>{NAME.split(" ").slice(1).join(" ")}</b>
          </Link>
          <div className="nav-links">
            <Link href="/login" className="btn btn-ghost btn-small">Log in</Link>
            <Link href="/register" className="btn btn-primary btn-small">Get started</Link>
          </div>
        </nav>

        <header className="hero">
          <div>
            <h1>
              One idea in. A complete <em>digital product</em> out.
            </h1>
            <p className="lead">
              Tell the studio your topic and audience. A team of AI agents writes an editable ebook, a landing page, an ad
              strategy and a go-to-market playbook, ready for you to review, brand and publish.
            </p>
            <div className="hero-cta">
              <Link href="/register" className="btn btn-primary">Create your first product</Link>
              <a href="#how" className="btn btn-ghost">See how it works</a>
            </div>
          </div>
          <aside className="deliver" aria-label="What you receive">
            <h3>What lands in your downloads</h3>
            <ul>
              <li><span className="tick">✓</span><span><b>Ebook (.docx)</b>: 12 chapters, styled, fully editable in Word</span></li>
              <li><span className="tick">✓</span><span><b>Landing page (.html)</b>: 10-section sales page</span></li>
              <li><span className="tick">✓</span><span><b>Ad strategy (.docx)</b>: audiences, hooks, budgets, setup steps</span></li>
              <li><span className="tick">✓</span><span><b>Go-to-market playbook (.docx)</b>: pricing, payments, emails, launch</span></li>
            </ul>
          </aside>
        </header>
      </div>

      <section className="section" id="how">
        <div className="container">
          <h2>How it works</h2>
          <p className="sub">A short conversation, then the agents work on their own while you watch the progress.</p>
          <div className="grid grid-3">
            <div className="card"><div className="step-no">1</div><h3>Describe your product</h3><p>Topic, audience, price point and depth. The studio asks for anything that is missing.</p></div>
            <div className="card"><div className="step-no">2</div><h3>Watch the team build</h3><p>Chapters are written and saved live. Files appear as they are ready.</p></div>
            <div className="card"><div className="step-no">3</div><h3>Download and make it yours</h3><p>Open the files in Word or any editor, adjust the voice, add your branding, then publish.</p></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Your product team</h2>
          <p className="sub">Seven specialist agents, coordinated by one supervisor.</p>
          <div className="grid grid-4">
            {agents.map(([emoji, name, text]) => (
              <div className="card agent" key={name}>
                <div className="emoji" aria-hidden>{emoji}</div>
                <div><b>{name}</b><span>{text}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="honest">
            <h2 style={{ fontSize: "1.4rem" }}>Straight talk about what this is</h2>
            <ul>
              <li>It produces <b>drafts and assets</b>. Read and edit everything before you sell it; you are the publisher.</li>
              <li>It does <b>not</b> publish your site, run your ads or take payments for you. The playbook shows you how.</li>
              <li>This version creates <b>text documents</b>. Covers and illustrations are added by you (for example in Canva).</li>
              <li>AI can be wrong. Check facts, quotes and claims, especially on health, money or legal topics.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: 760 }}>
          <h2>Questions</h2>
          <details><summary>Can I edit the files?</summary><p>Yes. The book and playbooks are normal Word files with real heading styles; the landing page is a single HTML file you can open in any editor.</p></details>
          <details><summary>How does pricing work?</summary><p>You pay per product using credits. Create an account to see the current credit packs.</p></details>
          <details><summary>How long does a book take?</summary><p>Usually several minutes for the full set. You can leave the page open and watch it progress.</p></details>
          <details><summary>Is the content original?</summary><p>It is generated for your topic, but you should review it, add your own experience and examples, and check any facts before publishing.</p></details>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band">
            <h2>Ready to build your first product?</h2>
            <p style={{ opacity: 0.85 }}>Create an account and start a project in under a minute.</p>
            <Link href="/register" className="btn btn-primary">Get started</Link>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">© {new Date().getFullYear()} {NAME}. AI-generated drafts: review before publishing.</div>
      </footer>
    </>
  );
}
