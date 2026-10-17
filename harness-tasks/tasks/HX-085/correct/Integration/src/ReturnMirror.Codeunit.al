codeunit 70428 "CGR Return Mirror"
{
    procedure StartReturnMirror()
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        DeskMirror.SetReturnMirror(true);
    end;

    procedure StopReturnMirror()
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        DeskMirror.SetReturnMirror(false);
    end;

    procedure IsReturnMirrorOn(): Boolean
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        exit(DeskMirror.IsReturnMirrorOn());
    end;
}
