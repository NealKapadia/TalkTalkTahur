import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PatientScreen from './PatientScreen';
import { PATIENT_VIEW } from './data';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {PATIENT_VIEW ? <PatientScreen /> : <App />}
  </StrictMode>
);
