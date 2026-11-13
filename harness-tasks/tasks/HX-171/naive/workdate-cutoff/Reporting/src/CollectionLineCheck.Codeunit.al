codeunit 70591 "CGR Collection Line Check"
{
    TableNo = "CGR Collection Preview Line";

    var
        NoAmountErr: Label 'Lease %1 schedule line %2 has no amount to collect.', Comment = '%1 = lease number, %2 = schedule line number';

    trigger OnRun()
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        ContractNo: Code[20];
        UpToDate: Date;
    begin
        ContractNo := Rec."Contract No.";
        UpToDate := WorkDate();
        Contract.Get(ContractNo);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        if ScheduleLine.FindSet() then
            repeat
                if ScheduleLine.Amount <= 0 then
                    Error(NoAmountErr, ContractNo, ScheduleLine."Line No.");
                Rec.Init();
                Rec."Contract No." := ContractNo;
                Rec."Line No." := ScheduleLine."Line No.";
                Rec."Due Date" := ScheduleLine."Due Date";
                Rec.Amount := ScheduleLine.Amount;
                Rec."Error Text" := '';
                Rec.Insert();
                OnAfterCollectionLineAdded(Rec);
            until ScheduleLine.Next() = 0;
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCollectionLineAdded(var PreviewLine: Record "CGR Collection Preview Line" temporary)
    begin
    end;
}
