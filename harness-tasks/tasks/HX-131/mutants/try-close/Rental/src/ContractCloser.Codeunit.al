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
            if TryCloseContract(CloseContract, Contract) then
                Closed += 1
            else
                LogFailure(ContractNo, GetLastErrorText());
        end;
        Commit();
        exit(Closed);
    end;

    [TryFunction]
    local procedure TryCloseContract(var CloseContract: Codeunit "CGR Close Contract"; var Contract: Record "CGR Rental Contract")
    begin
        CloseContract.CloseInPlace(Contract);
    end;

    local procedure LogFailure(ContractNo: Code[20]; ErrorText: Text)
    var
        Failure: Record "CGR Close Failure";
    begin
        Failure.Init();
        Failure."Contract No." := ContractNo;
        Failure."Error Text" := CopyStr(ErrorText, 1, MaxStrLen(Failure."Error Text"));
        Failure."Logged At" := CurrentDateTime();
        Failure.Insert(true);
    end;
}
