import type { ThemeRegistration } from 'shiki'

/**
 * Grayscale Shiki theme for e-ink displays.
 *
 * E-ink panels render ~16 gray levels and no color, so token classes are
 * distinguished by weight and slant (print typography) instead of hue:
 * keywords/tags bold, comments light italic, types italic, strings mid-gray.
 */
export const einkShikiTheme: ThemeRegistration = {
  name: 'eink',
  type: 'light',
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#000000',
  },
  settings: [
    { settings: { background: '#ffffff', foreground: '#000000' } },
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#6e6e6e', fontStyle: 'italic' },
    },
    {
      scope: ['string', 'string.template', 'punctuation.definition.string', 'constant.other.symbol'],
      settings: { foreground: '#3d3d3d' },
    },
    {
      scope: ['keyword', 'keyword.control', 'storage', 'storage.type', 'storage.modifier'],
      settings: { foreground: '#000000', fontStyle: 'bold' },
    },
    {
      scope: ['constant', 'constant.numeric', 'constant.language', 'support.constant'],
      settings: { foreground: '#1a1a1a' },
    },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'],
      settings: { foreground: '#000000', fontStyle: 'italic' },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function'],
      settings: { foreground: '#000000' },
    },
    {
      scope: ['variable', 'variable.parameter', 'variable.other'],
      settings: { foreground: '#1a1a1a' },
    },
    {
      scope: ['punctuation', 'meta.brace', 'keyword.operator'],
      settings: { foreground: '#444444' },
    },
    {
      scope: ['entity.name.tag'],
      settings: { foreground: '#000000', fontStyle: 'bold' },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: { foreground: '#3d3d3d', fontStyle: 'italic' },
    },
    {
      scope: ['markup.heading'],
      settings: { foreground: '#000000', fontStyle: 'bold' },
    },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    {
      scope: ['markup.inserted'],
      settings: { foreground: '#1a1a1a' },
    },
    {
      scope: ['markup.deleted'],
      settings: { foreground: '#6e6e6e' },
    },
  ],
}
