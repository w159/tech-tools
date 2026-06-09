import { Composition } from "remotion";
import { TerminalDemo } from "./TerminalDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TerminalDemo"
      component={TerminalDemo}
      durationInFrames={450}
      fps={30}
      width={800}
      height={500}
    />
  );
};
