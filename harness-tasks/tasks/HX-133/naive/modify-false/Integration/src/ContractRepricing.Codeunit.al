codeunit 70408 "CGR Contract Repricing"
{
    procedure RepriceOpenContracts(NewRateFactor: Decimal): Integer
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Facade: Codeunit "CGR Integration Facade";
        Branches: List of [Code[10]];
        BranchCode: Code[10];
        Repriced: Integer;
    begin
        Contract.SetRange(Status, Contract.Status::Open);
        if Contract.FindSet(true) then
            repeat
                Vehicle.Get(Contract."Vehicle No.");
                Contract."Agreed Daily Rate" := Round(Vehicle."Daily Rate" * NewRateFactor, 0.01);
                Contract.Modify(false);
                Repriced += 1;
                if not Branches.Contains(Contract."Branch Code") then
                    Branches.Add(Contract."Branch Code");
            until Contract.Next() = 0;
        foreach BranchCode in Branches do
            Facade.QueueMessage('ratesChanged', '', BranchCode);
        exit(Repriced);
    end;
}
