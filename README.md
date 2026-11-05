# Design Clover

Design Clover is a Windows desktop vector-design editor built with Electron, React, TypeScript, and Vite. Its native project format is `.dc`.

## Importing designs

Use the image/import button in the editor to open SVG, PDF, or Illustrator (`.ai`) files. Imports are added to the current canvas as one undoable operation and are included in autosaved and `.dc` project data.

- **SVG:** Reconstructs supported shapes, lines, polygons, paths, text, groups, transforms, inherited presentation styles, basic linear/radial gradients, and embedded raster/SVG images. Multiple path subpaths become separately editable path objects. Complex CSS selectors, external images, and clip paths, masks, and filters are not reconstructed; the importer reports limitations.
- **PDF:** Choose a page, then extract selectable text or import a high-resolution rendered page image. The image preserves appearance but is flattened; PDF vector paths and embedded artwork are not currently reconstructed.
- **Illustrator:** PDF-compatible `.ai` files use the PDF workflow. For older/non-PDF-compatible AI files, export as SVG or PDF from Illustrator and retry. Unsupported AI files are not treated as successfully imported.

Import files are limited to 20 MB. SVG import blocks active content and does not fetch external resources.

## Responsive design and website generation

- **Responsive layouts:** Switch among desktop, tablet, and mobile frames; set dimensions and breakpoints; configure object anchors, size modes, and grouped flex/grid layouts; and define device-specific position, size, and visibility overrides. Layout validation reports possible overflow, clipping, and overlap. Structure and component settings are saved with the project.
- **Structure and reusable components:** The Structure panel proposes a semantic hierarchy using geometry-based heuristics. Review and edit the suggested roles and names. Selected objects can be grouped into linked component definitions, instantiated, and given supported text, image, and fill overrides. Token suggestions are derived from repeated design values and can be edited and applied.
- **HTML/CSS and export:** Open Code mode to inspect generated semantic HTML, CSS, and detected structure, or use its preview and Export ZIP action. The ZIP contains `index.html`, `styles.css`, supported embedded image assets, and a README. The top-level Export button opens Code mode.

Generation is a best-effort translation, not a fully general design-to-code compiler. It uses heuristic structure detection and approximates some groups and responsive behavior; inspect generated output before using it in production. It does not generate React application components or detect responsive behavior that is not represented by the design and its explicit overrides.

Run `npm test` for unit tests covering import, serialization, responsive layout, structure, components, tokens, and website generation.

## Design Clover project files

Design Clover's native project format uses the `.dc` extension. Each file begins
with the `DESIGN CLOVER PROJECT` signature and contains a versioned JSON project
document. This identifies the file as a Design Clover project and leaves its
contents readable for recovery. Open `.dc` files in Design Clover or choose the
app under Windows' **Open with** menu. The installer registers `.dc` for your
Windows account without replacing an existing default app. Existing
`.clover.json` project files can still be opened.

## Development and Windows packaging

Install dependencies with `npm install`, then use:

```sh
npm run dev       # Vite renderer and Electron app
npm test          # Vitest unit tests
npm run build     # TypeScript checks and production renderer build
npm run dist:win  # Build the app and create the Windows NSIS installer
```

The Windows installer is written to `release/`. Windows packaging uses
`build/icon.ico` and the NSIS configuration in `build/installer.nsh`.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
