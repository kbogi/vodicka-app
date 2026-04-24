import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from '@/pages/HomePage';
import { RacersPage } from '@/pages/RacersPage';
import { StartPage } from '@/pages/StartPage';
import { FinishPage } from '@/pages/FinishPage';
import { ResultsPage } from '@/pages/ResultsPage';
import { Nav } from '@/components/Nav';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-full flex flex-col">
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/racers" element={<RacersPage />} />
            <Route path="/start" element={<StartPage />} />
            <Route path="/finish" element={<FinishPage />} />
            <Route path="/results" element={<ResultsPage />} />
          </Routes>
        </main>
        <Nav />
      </div>
    </BrowserRouter>
  );
}
