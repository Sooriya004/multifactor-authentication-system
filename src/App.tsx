import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HouseProvider } from "@/lib/houseContext";
import { AuthProvider } from "@/lib/authContext";
import { LockdownProvider } from "@/lib/lockdownContext";
import Index from "./pages/Index";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import Credentials from "./pages/Credentials";
import AuthSettings from "./pages/AuthSettings";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <HouseProvider>
      <AuthProvider>
      <LockdownProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/credentials" element={<Credentials />} />
            <Route path="/auth-settings" element={<AuthSettings />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </LockdownProvider>
      </AuthProvider>
      </HouseProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
