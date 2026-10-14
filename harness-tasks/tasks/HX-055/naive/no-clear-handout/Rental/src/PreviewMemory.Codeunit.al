codeunit 70225 "CGR Preview Memory"
{
    SingleInstance = true;

    var
        Kept: Record "CGR Kept Preview Line";

    procedure Store(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line")
    begin
        Kept.Reset();
        Kept.SetRange("Contract No.", ContractNo);
        Kept.DeleteAll();
        Kept.Reset();
        PreviewLine.Reset();
        if PreviewLine.FindSet() then
            repeat
                Kept.Init();
                Kept."Contract No." := ContractNo;
                Kept."Line No." := PreviewLine."Line No.";
                Kept.Description := PreviewLine.Description;
                Kept.Quantity := PreviewLine.Quantity;
                Kept."Unit Price" := PreviewLine."Unit Price";
                Kept.Amount := PreviewLine.Amount;
                Kept.Insert();
            until PreviewLine.Next() = 0;
    end;

    procedure Retrieve(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line"): Boolean
    var
        Found: Boolean;
    begin
        Kept.Reset();
        Kept.SetRange("Contract No.", ContractNo);
        Found := Kept.FindSet();
        if Found then
            repeat
                PreviewLine.Init();
                PreviewLine."Line No." := Kept."Line No.";
                PreviewLine."Contract No." := Kept."Contract No.";
                PreviewLine.Description := Kept.Description;
                PreviewLine.Quantity := Kept.Quantity;
                PreviewLine."Unit Price" := Kept."Unit Price";
                PreviewLine.Amount := Kept.Amount;
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
