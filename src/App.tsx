import {
  CoralShellColumn,
  CoralShellRow,
  Navbar,
  Content,
  Panel,
} from "@coral-ai/react";
import { CoralMarkdown } from "@coral-ai/markdown";

export default function App() {
  return (
    <CoralShellColumn>
      <Navbar logo={<img src="/toronto_pearson.svg" alt="Toronto Pearson" />} />

      <CoralShellRow>
            <Panel.Left>
        <Panel.Toolbar title={'hi'}/>
      </Panel.Left>
      <Content>
        <main
          style={{
            width: "100%",
            maxWidth: 800,
            margin: "0 auto",
            padding: 24,
            boxSizing: "border-box",
          }}
        >
          <CoralMarkdown>{`# Welcome to Coral

Your base app is ready. Start building in **src/App.tsx**.

React components, markdown, charts, icons, chat, and documentation components are installed.`}</CoralMarkdown>
        </main>
      </Content>
      </CoralShellRow>
  
    </CoralShellColumn>
  );
}
