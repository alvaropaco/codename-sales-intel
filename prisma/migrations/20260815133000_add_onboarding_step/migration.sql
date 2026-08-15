-- Persist the current onboarding step so a returning user resumes where
-- they stopped instead of restarting from step 0.
ALTER TABLE "CommercialSettings" ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 0;
