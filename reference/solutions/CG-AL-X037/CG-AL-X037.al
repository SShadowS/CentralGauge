codeunit 71260 "CG X037 Poster"
{
    Access = Internal;

    procedure PostBatch(BatchId: Integer; Value: Integer): Boolean
    var
        Ledger: Record "CG X037 Ledger";
    begin
        Ledger.Init();
        Ledger."Batch Id" := BatchId;
        Ledger."Step" := 0;
        Ledger."Amount" := Value;
        Ledger.Insert();

        Commit();

        if Codeunit.Run(Codeunit::"CG X037 Worker", Ledger) then
            exit(true);

        Ledger.Reset();
        Ledger.SetRange("Batch Id", BatchId);
        Ledger.DeleteAll();
        exit(false);
    end;
}