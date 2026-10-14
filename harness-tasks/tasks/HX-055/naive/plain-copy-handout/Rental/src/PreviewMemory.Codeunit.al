codeunit 70225 "CGR Preview Memory"
{
    SingleInstance = true;

    var
        Kept: Record "CGR Invoice Preview Line";
        KeptContractNo: Code[20];

    procedure Store(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line")
    begin
        Kept.Reset();
        Kept.DeleteAll();
        PreviewLine.Reset();
        if PreviewLine.FindSet() then
            repeat
                Kept := PreviewLine;
                Kept.Insert(false);
            until PreviewLine.Next() = 0;
        KeptContractNo := ContractNo;
    end;

    procedure Retrieve(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line"): Boolean
    begin
        if (KeptContractNo = '') or (KeptContractNo <> ContractNo) then begin
            PreviewLine.Reset();
            PreviewLine.DeleteAll();
            exit(false);
        end;
        PreviewLine.Copy(Kept);
        exit(true);
    end;

    procedure ForgetAll()
    begin
        Kept.Reset();
        Kept.DeleteAll();
        KeptContractNo := '';
    end;
}
