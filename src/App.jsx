import { Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Launcher from './app/Launcher.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<Launcher />} />
    </Routes>
  );
}
