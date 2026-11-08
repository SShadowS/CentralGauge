codeunit 70236 "CGR Contract Closer"
{
    procedure CloseExpired(AsOf: Date): Integer
    var
        Contract: Record "CGR Rental Contract";
        CloseContract: Codeunit "CGR Close Contract";
        ContractNos: List of [Code[20]];
        ContractNo: Code[20];
        Closed: Integer;
    begin
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.SetFilter("End Date", '..%1', AsOf - 1);
        if Contract.FindSet() then
            repeat
                ContractNos.Add(Contract."No.");
            until Contract.Next() = 0;
        foreach ContractNo in ContractNos do begin
            Commit();
            Contract.Get(ContractNo);
            CloseContract.SetClosingDate(AsOf);
            ClearLastError();
            if CloseContract.Run(Contract) then
                Closed += 1;
        end;
        Commit();
        exit(Closed);
    end;
}
