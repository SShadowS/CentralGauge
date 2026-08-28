codeunit 70972 "CG X137 Batch Poster"
{
    var
        LastPostedCount: Integer;
        LastSkippedCount: Integer;

    procedure PostBatch(BatchNo: Code[20])
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        LastPostedCount := 0;
        LastSkippedCount := 0;

        ImportLine.SetRange("Batch No.", BatchNo);
        if ImportLine.FindSet() then
            repeat
                // Skip lines this run has already posted, so a batch can be
                // re-run safely without posting the same line twice.
                if PostedEntry.Get(ImportLine."Entry No.") then
                    LastSkippedCount += 1
                else begin
                    if ImportLine.Amount <= 0 then
                        Error('Import line %1 in batch %2 has a non-positive amount and cannot be posted.', ImportLine."Entry No.", BatchNo);

                    PostedEntry.Init();
                    PostedEntry."Entry No." := ImportLine."Entry No.";
                    PostedEntry."Batch No." := BatchNo;
                    PostedEntry.Amount := ImportLine.Amount;
                    PostedEntry.Insert();

                    LastPostedCount += 1;
                end;
            until ImportLine.Next() = 0;
    end;

    procedure PostedCountLastRun(): Integer
    begin
        exit(LastPostedCount);
    end;

    procedure SkippedCountLastRun(): Integer
    begin
        exit(LastSkippedCount);
    end;
}
