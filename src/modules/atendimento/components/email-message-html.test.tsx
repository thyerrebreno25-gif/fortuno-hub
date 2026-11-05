import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EmailMessageHtml } from "./email-message-html";

it("keeps hostile email markup inside a sandbox without script, origin, form or navigation privileges", () => {
  const html = '<script>parent.location="https://evil.test"</script><img src=x onerror="alert(1)"><form action="https://evil.test"></form>';
  const markup = renderToStaticMarkup(<EmailMessageHtml title="Email" html={html} />);
  expect(markup).toContain('sandbox=""');
  expect(markup).toContain('referrerPolicy="no-referrer"');
  expect(markup).toContain('srcDoc="&lt;script&gt;');
  expect(markup).not.toMatch(/<script|<img|<form|allow-scripts|allow-same-origin|allow-forms|allow-top-navigation/);
});
