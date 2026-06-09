import { Composition } from "remotion";
import { MinutesDemo } from "./MinutesDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MinutesDemo"
      component={MinutesDemo}
      durationInFrames={630}
      fps={15}
      width={900}
      height={550}
    />
  );
};
