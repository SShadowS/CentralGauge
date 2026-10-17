codeunit 70427 "CGR Checkout Mirror"
{
    procedure StartCheckoutMirror()
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        DeskMirror.SetCheckoutMirror(true);
    end;

    procedure StopCheckoutMirror()
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        DeskMirror.SetCheckoutMirror(false);
    end;

    procedure IsCheckoutMirrorOn(): Boolean
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        exit(DeskMirror.IsCheckoutMirrorOn());
    end;
}
