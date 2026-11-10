codeunit 70280 "CGR Contract Cancellation"
{
    procedure CancelContract(ContractNo: Code[20]; CancelDate: Date; Waive: Boolean): Boolean
    var
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Cancellation Entry";
        Failure: Record "CGR Cancellation Failure";
        CancelRun: Codeunit "CGR Cancellation Run";
        FeeCalc: Codeunit "CGR Cancellation Fee";
        PostLedger: Codeunit "CGR Rental-Post Ledger";
    begin
        Contract.Get(ContractNo);
        Entry.SetRange("Contract No.", ContractNo);
        if not Entry.IsEmpty() then
            exit(false);
        if (Contract.Status = Contract.Status::Open) and not Waive then begin
            PostLedger.InsertEntry(Contract, FeeCalc.CalcCancellationFee(Contract, CancelDate, Waive));
            Commit();
        end;
        CancelRun.SetCancellation(CancelDate, Waive);
        ClearLastError();
        if CancelRun.Run(Contract) then
            exit(true);
        Failure.Init();
        Failure."Contract No." := ContractNo;
        Failure."Error Message" := CopyStr(GetLastErrorText(), 1, MaxStrLen(Failure."Error Message"));
        Failure.Insert(true);
        Commit();
        exit(false);
    end;
}
