codeunit 70502 "CG X085 Batch Reissue Mgt"
{
    // Recreates a batch header from the configured template, replacing
    // whatever header currently exists for the given batch number.
    procedure Reissue(BatchNo: Code[20])
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        BatchHeader.SetRange("No.", BatchNo);
        BatchHeader.DeleteAll(true);

        BuildReplacementBatch(BatchNo);
    end;

    local procedure BuildReplacementBatch(BatchNo: Code[20])
    var
        ReissueSetup: Record "CG X085 Reissue Setup";
        NewBatchHeader: Record "CG X085 Batch Header";
    begin
        ReissueSetup.Get();
        ReissueSetup.TestField("Default Batch Template");

        NewBatchHeader.Init();
        NewBatchHeader."No." := BatchNo;
        NewBatchHeader.Description := ReissueSetup."Default Description";
        NewBatchHeader."Template Code" := ReissueSetup."Default Batch Template";
        NewBatchHeader."Created Date" := Today;
        NewBatchHeader.Status := NewBatchHeader.Status::Open;
        NewBatchHeader.Insert(true);
    end;
}
