codeunit 70408 "CGR Contract Repricing"
{
    var
        RateFactor: Decimal;
        RepricedCount: Integer;
        RepricedBranches: List of [Code[10]];

    procedure RepriceOpenContracts(NewRateFactor: Decimal): Integer
    var
        Worker: Codeunit "CGR Contract Repricing";
        Silencer: Codeunit "CGR Integration Silencer";
        Facade: Codeunit "CGR Integration Facade";
        Branches: List of [Code[10]];
        BranchCode: Code[10];
        RunError: Text;
        Ok: Boolean;
    begin
        // Silence the messages through the single-instance flag only: binding the Silencer
        // would also activate its import-only subscriber, which suspends the block check.
        Worker.SetRateFactor(NewRateFactor);
        Silencer.SilenceMessages();
        Ok := Worker.Run();
        Silencer.ResumeMessages();
        if not Ok then begin
            RunError := GetLastErrorText();
            Error('%1', RunError);
        end;
        Worker.GetRepricedBranches(Branches);
        foreach BranchCode in Branches do
            Facade.QueueMessage('ratesChanged', '', BranchCode);
        exit(Worker.GetRepricedCount());
    end;

    internal procedure SetRateFactor(NewRateFactor: Decimal)
    begin
        RateFactor := NewRateFactor;
    end;

    internal procedure GetRepricedCount(): Integer
    begin
        exit(RepricedCount);
    end;

    internal procedure GetRepricedBranches(var Branches: List of [Code[10]])
    begin
        Branches := RepricedBranches;
    end;

    trigger OnRun()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
    begin
        Contract.SetRange(Status, Contract.Status::Open);
        if Contract.FindSet(true) then
            repeat
                Vehicle.Get(Contract."Vehicle No.");
                Contract."Agreed Daily Rate" := Round(Vehicle."Daily Rate" * RateFactor, 0.01);
                Contract.Modify(true);
                RepricedCount += 1;
                if not RepricedBranches.Contains(Contract."Branch Code") then
                    RepricedBranches.Add(Contract."Branch Code");
            until Contract.Next() = 0;
    end;
}
