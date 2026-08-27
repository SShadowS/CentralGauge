codeunit 71300 "CG X041 Clerk"
{
    Access = Internal;

    procedure PostDoc(BatchId: Integer; Value: Integer): Boolean
    var
        Doc: Record "CG X041 Doc";
    begin
        Doc.Init();
        Doc."Batch Id" := BatchId;
        Doc."Line No." := 0;
        Doc.Status := Doc.Status::Open;
        Doc."Amount" := Value;
        Doc.Insert();

        Commit();

        if Codeunit.Run(Codeunit::"CG X041 Worker", Doc) then
            exit(true);

        ClearLastError();

        Doc.Reset();
        Doc.SetRange("Batch Id", BatchId);
        Doc.SetRange(Status, Doc.Status::Open);
        Doc.DeleteAll();

        exit(false);
    end;
}