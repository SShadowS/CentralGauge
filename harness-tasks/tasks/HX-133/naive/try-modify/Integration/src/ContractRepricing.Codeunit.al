codeunit 70408 "CGR Contract Repricing"
{
    procedure RepriceOpenContracts(NewRateFactor: Decimal): Integer
    var
        Contract: Record "CGR Rental Contract";
        Silencer: Codeunit "CGR Integration Silencer";
        Facade: Codeunit "CGR Integration Facade";
        Branches: List of [Code[10]];
        BranchCode: Code[10];
        RunError: Text;
        Repriced: Integer;
    begin
        Silencer.SilenceMessages();
        Contract.SetRange(Status, Contract.Status::Open);
        if Contract.FindSet(true) then
            repeat
                if not TryRepriceContract(Contract, NewRateFactor) then begin
                    RunError := GetLastErrorText();
                    Silencer.ResumeMessages();
                    Error('%1', RunError);
                end;
                Repriced += 1;
                if not Branches.Contains(Contract."Branch Code") then
                    Branches.Add(Contract."Branch Code");
            until Contract.Next() = 0;
        Silencer.ResumeMessages();
        foreach BranchCode in Branches do
            Facade.QueueMessage('ratesChanged', '', BranchCode);
        exit(Repriced);
    end;

    [TryFunction]
    local procedure TryRepriceContract(var Contract: Record "CGR Rental Contract"; NewRateFactor: Decimal)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(Contract."Vehicle No.");
        Contract."Agreed Daily Rate" := Round(Vehicle."Daily Rate" * NewRateFactor, 0.01);
        Contract.Modify(true);
    end;
}
