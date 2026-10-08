import MarkdownIt from 'markdown-it';

// HTML devre dışı: ham <script> vb. etiketler metin olarak kaçışlanır. Bağlantılar güvenli şemalarla sınırlıdır.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });

const defaultLinkOpen =
  md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer nofollow');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(source) {
  return md.render(String(source ?? ''));
}
