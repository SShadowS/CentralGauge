codeunit 70285 "CGR Checkout SMS"
{
    SingleInstance = true;

    var
        TempSms: Record "CGR SMS Buffer" temporary;
        ReadyMsg: Label 'Your car %1 is ready.', Comment = '%1 = vehicle number';

    procedure CheckOutAndNotify(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Contract.Get(ContractNo);
        RentalMgt.CheckOut(ContractNo);
        QueueSms(ContractNo, StrSubstNo(ReadyMsg, Contract."Vehicle No."));
    end;

    procedure Flush() Sent: Integer
    var
        SendUnit: Codeunit "CGR SMS Send";
    begin
        if TempSms.FindSet() then
            repeat
                Clear(SendUnit);
                if SendUnit.Run(TempSms) then begin
                    TempSms.Delete();
                    Sent += 1;
                end;
            until TempSms.Next() = 0;
    end;

    procedure PendingCount(): Integer
    begin
        exit(TempSms.Count());
    end;

    procedure Reset()
    begin
        TempSms.Reset();
    end;

    local procedure QueueSms(ContractNo: Code[20]; MessageText: Text)
    var
        LastNo: Integer;
    begin
        TempSms.Reset();
        if TempSms.FindLast() then
            LastNo := TempSms."Entry No.";
        TempSms.Init();
        TempSms."Entry No." := LastNo + 1;
        TempSms."Contract No." := ContractNo;
        TempSms."Message Text" := CopyStr(MessageText, 1, MaxStrLen(TempSms."Message Text"));
        TempSms.Insert();
    end;
}
