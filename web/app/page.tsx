import Link from "next/link";
import Brand from "@/components/Brand";

const NAME = process.env.NEXT_PUBLIC_APP_NAME || "E-Book Agent";

const agents = [
  ["🔍", "Research Agent", "Finds expert frameworks and shapes the chapter-by-chapter plan"],
  ["✍️", "Writer Agent", "Writes the full book, chapter by chapter, with one continuous story"],
  ["📘", "Publisher Agent", "Builds a designed, editable Word (.docx) book and a matching PDF"],
  ["🎨", "Illustrator Agent", "Optional AI cover and chapter pictures, in one consistent style"],
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
          <Brand />
          <div className="nav-links">
            <Link href="/login" className="btn btn-ghost btn-small">Log in</Link>
            <Link href="/register" className="btn btn-primary btn-small">Get started</Link>
          </div>
        </nav>

        <header className="hero">
          <div>
            <h1>
              One idea in. A finished <em>ebook</em> out.
            </h1>
            <p className="lead">
              Tell {NAME} your topic and your readers. It plans, writes and designs a book you can edit in Word and share as
              a PDF, with optional AI pictures. It can also write the sales page and launch plan.
            </p>
            <div className="hero-cta">
              <Link href="/register" className="btn btn-primary">Create your first ebook</Link>
              <a href="#how" className="btn btn-ghost">See how it works</a>
            </div>
          </div>
          <aside className="deliver" aria-label="What you receive">
            <h3>What lands in your downloads</h3>
            <ul>
              <li><span className="tick">✓</span><span><b>Ebook (.docx)</b>: designed cover, contents and chapters, fully editable in Word</span></li>
              <li><span className="tick">✓</span><span><b>Ebook (.pdf)</b>: the same book, ready to share</span></li>
              <li><span className="tick">✓</span><span><b>Story books</b>: illustrated children&apos;s stories with AI pictures, on request</span></li>
              <li><span className="tick">✓</span><span><b>Launch kit</b>: landing page, ad strategy and sales playbook, on request</span></li>
            </ul>
          </aside>
        </header>
      </div>

      <section className="section" id="how">
        <div className="container">
          <h2>How it works</h2>
          <p className="sub">A short conversation, then the agents work on their own while you watch the progress.</p>
          <div className="grid grid-3">
            <div className="card"><div className="step-no">1</div><h3>Describe your book</h3><p>Topic, readers, length and style. The agent asks only for what is missing.</p></div>
            <div className="card"><div className="step-no">2</div><h3>Watch it get built</h3><p>Chapters are written and saved live. Files appear as soon as they are ready.</p></div>
            <div className="card"><div className="step-no">3</div><h3>Download and make it yours</h3><p>Open the Word file, adjust the voice, add your own examples and branding, then publish.</p></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Your book team</h2>
          <p className="sub">Specialist agents, coordinated by one supervisor.</p>
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
              <li>AI pictures are <b>optional</b>. Check each one, and in story books a character can look a little different from page to page.</li>
              <li>It does <b>not</b> publish your site, run your ads or take payments for you. The playbook shows you how.</li>
              <li>AI can be wrong. Check facts, quotes and claims, especially on health, money or legal topics.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: 760 }}>
          <h2>Questions</h2>
          <details><summary>Can I edit the files?</summary><p>Yes. The book is a normal Word file with real heading styles and a contents page. The landing page is a single HTML file you can open in any editor.</p></details>
          <details><summary>Do I get a PDF too?</summary><p>Yes. Each book is built as a Word file and a matching PDF.</p></details>
          <details><summary>How does pricing work?</summary><p>You pay per product using credits. Create an account to see the current credit packs.</p></details>
          <details><summary>How long does a book take?</summary><p>Usually several minutes. Books with AI pictures take longer. You can leave the page open and watch it progress.</p></details>
          <details><summary>Is the content original?</summary><p>It is generated for your topic, but you should review it, add your own experience and examples, and check any facts before publishing.</p></details>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band">
            <h2 style={{ color: "#fff" }}>Ready to write your first ebook?</h2>
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
