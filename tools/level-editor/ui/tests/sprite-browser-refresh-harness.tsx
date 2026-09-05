import { createRoot } from 'react-dom/client';
import AnimationLibraryPage from '../src/components/AnimationLibraryPage';
import '../src/App.css';

// The in-wizard sprite browser was retired. Exercise source refresh through
// the current library, which owns candidate selection and wizard remounts.
const root = document.getElementById('root');
if (root === null) throw new Error('Missing root');
createRoot(root).render(<AnimationLibraryPage />);
