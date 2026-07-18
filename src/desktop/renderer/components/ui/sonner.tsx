import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-hooman-success" />,
        info: <InfoIcon className="size-4 text-hooman-info" />,
        warning: <TriangleAlertIcon className="size-4 text-hooman-warning" />,
        error: <OctagonXIcon className="size-4 text-hooman-error" />,
      }}
      toastOptions={{
        style: {
          background: "#0f172a",
          border: "1px solid #1e293b",
          color: "#e2e8f0",
          fontSize: "13px",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
