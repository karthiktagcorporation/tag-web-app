import { useDropzone } from "react-dropzone";
import { CheckCircle2, FileSpreadsheet, FileText, Loader2 } from "lucide-react";

type Theme = "green" | "purple";

interface Props {
  theme: Theme;
  title: string;
  subtitle: string;
  accept: Record<string, string[]>;
  uploading: boolean;
  fileName: string | null;
  successDetail?: string | null;
  onFile: (file: File) => void;
}

const themes = {
  green: {
    border: "#48BB78",
    hoverBg: "#F0FFF4",
    text: "#2F855A",
    Icon: FileSpreadsheet,
  },
  purple: {
    border: "#805AD5",
    hoverBg: "#FAF5FF",
    text: "#6B46C1",
    Icon: FileText,
  },
};

export function UploadCard({
  theme,
  title,
  subtitle,
  accept,
  uploading,
  fileName,
  successDetail,
  onFile,
}: Props) {
  const t = themes[theme];
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    multiple: false,
    onDrop: (files) => {
      if (files[0]) onFile(files[0]);
    },
  });

  const Icon = t.Icon;

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <div
        {...getRootProps()}
        className="rounded-lg p-8 text-center cursor-pointer transition-colors"
        style={{
          border: `2px dashed ${t.border}`,
          background: isDragActive ? t.hoverBg : "transparent",
        }}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-3">
          {uploading ? (
            <Loader2 className="h-10 w-10 animate-spin" style={{ color: t.text }} />
          ) : fileName ? (
            <CheckCircle2 className="h-10 w-10" style={{ color: t.text }} />
          ) : (
            <Icon className="h-10 w-10" style={{ color: t.text }} />
          )}
          <div className="font-bold text-base text-gray-800">{title}</div>
          {fileName ? (
            <>
              <div className="text-sm font-medium" style={{ color: t.text }}>
                {fileName}
              </div>
              {successDetail && (
                <div className="text-sm" style={{ color: t.text }}>
                  {successDetail}
                </div>
              )}
            </>
          ) : (
            <div className="text-[13px] text-gray-500">{subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}
