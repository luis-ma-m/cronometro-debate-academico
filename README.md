
# Debate Chronometer ⏱️

A professional debate chronometer for academic tournaments supporting BP, WSDC, and CNED formats with real-time timers, question tracking, and cross-examination management.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/debate-chronometer)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/your-username/debate-chronometer)

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│      React      │───▶│       Vite       │───▶│   Production    │
│   Components    │    │   Build Tool     │    │     Bundle      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌──────────────────┐
│   Tailwind CSS  │    │   shadcn-ui      │
│   Styling       │    │   Components     │
└─────────────────┘    └──────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌──────────────────┐
│  TanStack Query │    │     Zustand      │
│  Data Fetching  │    │  State Manager   │
└─────────────────┘    └──────────────────┘
```

- **React 18**: UI framework with functional components and hooks
- **Vite**: Fast build tool with HMR and optimized bundling
- **Tailwind CSS**: Utility-first CSS framework for responsive design
- **shadcn-ui**: Accessible component library built on Radix UI
- **TanStack Query**: Server state management and caching
- **Zustand**: Lightweight state management with persistence

## 📚 Debate Format Configuration

### Compatible Formats

| Format | Categories | Timer Duration | Cross-Examination | Question Tracking |
|--------|------------|----------------|-------------------|-------------------|
| **FUTURE, NOT IMPLEMENTED - BP (British Parliamentary)** | Opening Government, Opening Opposition, Closing Government, Closing Opposition | 7 min speeches | Optional | Yes for refutations |
| **WSDC (World Schools)** | Introduction, Refutation 1, Refutation 2, Conclusion | 4-5 min speeches | 1.5 min | Yes for refutations |
| **CNED (Spanish Academic)** | Introducción, Refutación 1, Refutación 2, Conclusión | 3-5 min speeches | 1.5 min | Minimum 1-2 questions |

### URL Parameters

Configure debate formats via URL parameters:

```bash
# FUTURE, NOT IMPLEMENTED - British Parliamentary format
?format=bp&duration=420&cross_exam=false

# World Schools format
?format=wsdc&duration=300&cross_exam=90&questions=2

# Custom format via JSON
?config={"categories":[{"name":"Opening","duration":480,"type":"introduction","cross_exam":true}]}
```

### JSON Configuration

```json
{
  "format": "custom",
  "globalSettings": {
    "h1Text": "Tournament Name",
    "logoUrl": "https://example.com/logo.png",
    "positiveWarningThreshold": 30,
    "negativeWarningThreshold": -30
  },
  "categories": [
    {
      "name": "Introduction",
      "timeFavor": 240,
      "timeContra": 240,
      "type": "introduccion",
      "cross_exam": true,
      "timeExamenCruzadoFavor": 90,
      "timeExamenCruzadoContra": 90
    }
  ]
}
```

## ⚡ Features

### High-Precision Timing
- **Web Worker Implementation**: Drift-free timing using `performance.now()` and `requestAnimationFrame`
- **60 FPS Updates**: Smooth visual updates with sub-millisecond accuracy
- **Background Resilience**: Maintains accuracy when browser tab is inactive
- **Average Drift**: ≤ 5ms over 10-minute periods (tested)

### Accessibility (WCAG AA Compliant)
- **Semantic HTML**: Proper `<section>`, `<header>`, `<button>` elements
- **Keyboard Navigation**: 
  - `Space`: Start/Stop current timer
  - `R`: Reset current timer  
  - `→`: Navigate to next speech

### Real-time State Management
- **Zustand Store**: Centralized state with automatic persistence
- **FUTURE, NOT IMPLEMENTED - localStorage Sync**: Survives browser refreshes and tab closures
- **Cross-component Updates**: Real-time synchronization across all timers

### Question Tracking
- **Visual Progress**: Answered/unanswered question indicators
- **Minimum Requirements**: Enforced minimum questions per refutation
- **Dynamic Addition**: Add questions during debate
- **Statistical Summary**: Full summary of the status of the debate, chronometers and even questions for each category.

## 🌐 Environment Limitations

This application relies on Web Workers for accurate timing. In environments where
the Worker API isn't available—such as some mobile browsers or server-side
rendering setups—the chronometers will not start. Run the app in a modern
browser or provide a polyfill to enable worker support. See
[`src/hooks/useChronometerWorker.ts`](src/hooks/useChronometerWorker.ts) for
implementation details.

### Custom Error Handling

`useChronometerWorker` accepts an optional `onError` callback. When provided,
any worker-related exceptions are forwarded to this function instead of being
logged with `console.error`. Use it to surface issues via a toast or other UI.

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run accessibility audit
pnpm test:a11y

# Run timer precision tests
pnpm test:timers
```

### Timer Precision Tests
Using `@sinonjs/fake-timers` to verify timing accuracy:

```typescript
describe('ChronometerWorker', () => {
  it('maintains ≤5ms average drift over 10 minutes', async () => {
    const worker = new ChronometerWorker();
    const driftSamples: number[] = [];
    
    // Test 10 minutes of operation
    for (let i = 0; i < 600; i++) {
      clock.tick(1000); // Advance 1 second
      const response = await getWorkerResponse(worker);
      driftSamples.push(response.drift);
    }
    
    const averageDrift = driftSamples.reduce((a, b) => a + b, 0) / driftSamples.length;
    expect(averageDrift).toBeLessThanOrEqual(5);
  });
});
```

## 🤝 Contributing

We use Conventional Commits and Commitizen for consistent commit messages.

### Setup Development Environment

```bash
# Clone repository
git clone https://github.com/your-username/debate-chronometer.git
cd debate-chronometer

# Install dependencies
pnpm install

# Install commitizen globally (optional)
pnpm add -g commitizen cz-conventional-changelog

# Setup pre-commit hooks
pnpm run prepare
```

### Commit Guidelines

```bash
# Using commitizen (recommended)
pnpm run commit

# Or manually following conventional commits
git commit -m "feat(timer): add drift compensation algorithm"
git commit -m "fix(ui): resolve accessibility contrast issue"
git commit -m "docs(readme): update architecture diagram"
```

### Pre-commit Hooks (lint-staged)

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{md,json}": ["prettier --write"],
    "*.{ts,tsx}": ["vitest related --run"]
  }
}
```

### Pull Request Process

1. Fork the repository
2. Create feature branch: `git checkout -b feat/amazing-feature`
3. Make your changes following our coding standards
4. Add tests for new functionality
5. Run the full test suite: `pnpm test`
6. Commit using conventional commits
7. Push to your fork and submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🚀 Deployment

### Vercel (Recommended)
1. Connect your GitHub repository to Vercel
2. Set build command: `pnpm build`
3. Set output directory: `dist`
4. Deploy automatically on push to main

### Netlify
1. Connect repository to Netlify
2. Set build command: `pnpm build`
3. Set publish directory: `dist`
4. Configure redirects for SPA routing

### Manual Deployment
```bash
# Build for production
pnpm build

# Upload dist/ folder to your hosting provider
```

## 🎯 Roadmap

- [ ] Tournament bracket integration
- [ ] Judge scoring integration

---

Built with ❤️ by Luis Martín Maíllo, for the debate community.
