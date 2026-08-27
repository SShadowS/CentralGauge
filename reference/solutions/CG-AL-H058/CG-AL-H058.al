codeunit 70580 "CG H058 Codec"
{
    Access = Public;

    procedure EncodeBase64(Plain: Text) B64: Text
    var
        TempBlob: Codeunit "Temp Blob";
        Base64Convert: Codeunit "Base64 Convert";
        OutStr: OutStream;
        InStr: InStream;
    begin
        TempBlob.CreateOutStream(OutStr, TextEncoding::UTF8);
        OutStr.WriteText(Plain);
        TempBlob.CreateInStream(InStr, TextEncoding::UTF8);
        B64 := Base64Convert.ToBase64(InStr);
    end;

    procedure DecodeBase64(B64: Text) Plain: Text
    var
        TempBlob: Codeunit "Temp Blob";
        Base64Convert: Codeunit "Base64 Convert";
        OutStr: OutStream;
        InStr: InStream;
    begin
        TempBlob.CreateOutStream(OutStr, TextEncoding::UTF8);
        Base64Convert.FromBase64(B64, OutStr);
        TempBlob.CreateInStream(InStr, TextEncoding::UTF8);
        InStr.ReadText(Plain);
    end;
}