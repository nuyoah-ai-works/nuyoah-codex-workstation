import { connectMainCodex } from "./cdp-client.mjs";

const port = Number(process.env.CODEX_DEBUG_PORT || 9231);
const client = await connectMainCodex(port);

try {
  const snapshot = await client.evaluate(`(() => {
    const scroll = document.querySelector('[data-app-action-sidebar-scroll]');
    if (!scroll) return { error: 'sidebar scroll not found' };
    const sections = Array.from(scroll.querySelectorAll('[data-app-action-sidebar-section]'));
    return {
      location: location.href,
      bodyText: document.body.innerText.slice(0, 2000),
      sections: sections.map((section) => ({
        text: section.innerText.slice(0, 1200),
        html: section.outerHTML.slice(0, 8000),
      })),
      buttons: Array.from(scroll.querySelectorAll('button')).map((button) => ({
        text: button.innerText,
        ariaLabel: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
        describedBy: button.getAttribute('aria-describedby'),
        data: Object.fromEntries(Array.from(button.attributes)
          .filter((attribute) => attribute.name.startsWith('data-'))
          .map((attribute) => [attribute.name, attribute.value])),
        html: button.outerHTML.slice(0, 4000),
      })).filter((button) => button.text || button.ariaLabel),
    };
  })()`);
  console.log(JSON.stringify(snapshot, null, 2));
} finally {
  client.close();
}
