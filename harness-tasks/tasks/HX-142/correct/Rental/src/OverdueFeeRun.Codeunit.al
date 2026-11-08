codeunit 70257 "CGR Overdue Fee Run"
{
    procedure ChargeOverdueFees(AsOf: Date): Integer
    var
        Contract: Record "CGR Rental Contract";
        Charge: Codeunit "CGR Overdue Fee Charge";
        ContractNos: List of [Code[20]];
        ContractNo: Code[20];
        Charged: Integer;
    begin
        Contract.SetRange(Status, Contract.Status::"Checked Out");
        Contract.SetFilter("End Date", '<%1', AsOf);
        if Contract.FindSet() then
            repeat
                ContractNos.Add(Contract."No.");
            until Contract.Next() = 0;
        foreach ContractNo in ContractNos do begin
            Commit();
            Contract.Get(ContractNo);
            Clear(Charge);
            Charge.SetAsOf(AsOf);
            if Charge.DaysDue(Contract) > 0 then
                if Charge.Run(Contract) then begin
                    Charged += 1;
                    Contract.Get(ContractNo);
                    Contract."Fees Charged Through" := AsOf;
                    Contract.Modify();
                end;
        end;
        Commit();
        exit(Charged);
    end;
}
