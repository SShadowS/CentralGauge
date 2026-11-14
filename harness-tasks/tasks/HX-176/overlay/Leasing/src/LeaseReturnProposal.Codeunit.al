codeunit 70394 "CGR Lease Return Proposal"
{
    procedure BuildReturnProposal(ContractNo: Code[20]; ExcessKm: Decimal; KmRate: Decimal; DamageAmount: Decimal; var TempCharge: Record "CGR Lease Return Charge" temporary; var LineCount: Integer): Decimal
    var
        Contract: Record "CGR Lease Contract";
        Total: Decimal;
    begin
        Contract.Get(ContractNo);
        TempCharge.Reset();
        TempCharge.DeleteAll();
        if ExcessKm > 0 then
            AddReturnCharge(TempCharge, ContractNo, 'Excess km', Round(ExcessKm * KmRate, 0.01), true);
        if DamageAmount > 0 then
            AddReturnCharge(TempCharge, ContractNo, 'Damage', DamageAmount, true);
        AddReturnCharge(TempCharge, ContractNo, 'Return inspection', 75, false);

        LineCount := 0;
        Total := 0;
        TempCharge.Reset();
        if TempCharge.FindSet() then
            repeat
                LineCount += 1;
                if TempCharge."Bill Customer" then
                    Total += TempCharge.Amount;
            until TempCharge.Next() = 0;
        exit(Total);
    end;

    procedure AcceptReturnProposal(var TempCharge: Record "CGR Lease Return Charge" temporary)
    var
        Charge: Record "CGR Lease Return Charge";
    begin
        TempCharge.Reset();
        if TempCharge.FindSet() then
            repeat
                Charge := TempCharge;
                Charge.Insert(true);
            until TempCharge.Next() = 0;
    end;

    local procedure AddReturnCharge(var TempCharge: Record "CGR Lease Return Charge" temporary; ContractNo: Code[20]; Description: Text[100]; Amount: Decimal; BillCustomer: Boolean)
    var
        LineNo: Integer;
    begin
        TempCharge.Reset();
        TempCharge.SetRange("Contract No.", ContractNo);
        if TempCharge.FindLast() then
            LineNo := TempCharge."Line No.";
        TempCharge.Reset();
        TempCharge.Init();
        TempCharge."Contract No." := ContractNo;
        TempCharge."Line No." := LineNo + 10000;
        TempCharge.Description := Description;
        TempCharge.Amount := Amount;
        TempCharge."Bill Customer" := BillCustomer;
        TempCharge.Insert();
    end;
}
