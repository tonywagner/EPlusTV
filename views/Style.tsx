import type {FC} from 'hono/jsx';

export const Style: FC = () => (
  <style>{`
    pre {
      padding: 5px;
    }
    .align-center {
      align-content: center;
    }
    .title {
      font-family: 'sans-serif';
      font-weight: normal;
    }
    .title-bold {
      font-weight: 900;
      color: red;
    }
    .help-text {
      margin-bottom: 0px;
      color: red;
    }
    .provider-section {
      // max-height: 30rem;
    }
    .grid-container {
      display: grid;
      grid-template-columns: 1fr auto;
      justify-items: stretch;
      align-items: stretch;
      padding-right: 1rem;
    }
    .grid-container-3 {
      display: grid;
      grid-template-columns: 1fr auto auto;
      grid-column-gap: 10px;
      justify-items: stretch;
      align-items: stretch;
      padding-right: 1rem;
    }
    .warning-red {
      color: red;
    }
  `}</style>
);
