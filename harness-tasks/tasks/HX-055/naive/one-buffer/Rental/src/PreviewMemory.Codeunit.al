codeunit 70225 "CGR Preview Memory"
{
    SingleInstance = true;

    var
        Kept: Record "CGR Invoice Preview Line";

    procedure Store(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line")
    begin
        Kept.Reset();
        Kept.SetRange("Contract No.", ContractNo);
        Kept.DeleteAll();
        Kept.Reset();
        PreviewLine.Reset();
        if PreviewLine.FindSet() then
            repeat
                Kept := PreviewLine;
                Kept."Contract No." := ContractNo;
                Kept.Insert(false);
            until PreviewLine.Next() = 0;
    end;

    procedure Retrieve(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line"): Boolean
    var
        Found: Boolean;
    begin
        PreviewLine.Reset();
        PreviewLine.DeleteAll();
        Kept.Reset();
        Kept.SetRange("Contract No.", ContractNo);
        Found := Kept.FindSet();
        if Found then
            repeat
                PreviewLine := Kept;
                PreviewLine.Insert(false);
            until Kept.Next() = 0;
        Kept.Reset();
        exit(Found);
    end;

    procedure ForgetAll()
    begin
        Kept.Reset();
        Kept.DeleteAll();
    end;
}
