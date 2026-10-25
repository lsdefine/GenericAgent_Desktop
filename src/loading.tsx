import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { semiGlobal } from '@douyinfe/semi-ui';

// React 19 no longer exports createRoot from react-dom.
semiGlobal.config.createRoot = createRoot;
import './loading/bootstrap.css';
import { LoadingApp } from './loading/App';

const container = document.getElementById('loading-root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <LoadingApp />
    </StrictMode>
  );
}
