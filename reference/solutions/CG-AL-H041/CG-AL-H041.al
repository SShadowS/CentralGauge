codeunit 70410 "CG H041 Worker"
{
    Access = Public;
    SubType = Normal;
    TableNo = "CG H041 Item";

    trigger OnRun()
    begin
        if Rec.Marker = 'OK' then begin
            Rec.Status := 'DONE';
            Rec.Modify(true);
        end else
            Error('Worker rejected %1', Rec.Code);
    end;
}

codeunit 70411 "CG H041 Batch"
{
    Access = Public;

    procedure RunBatch(var Codes: List of [Code[20]]) Outcomes: List of [Code[10]]
    var
        Item: Record "CG H041 Item";
        RunLog: Record "CG H041 Run Log";
        ItemCode: Code[20];
        Outcome: Code[10];
        JoinedOutcomes: Text;
    begin
        foreach ItemCode in Codes do begin
            Item.Get(ItemCode);
            if Codeunit.Run(Codeunit::"CG H041 Worker", Item) then
                Outcomes.Add('OK')
            else
                Outcomes.Add('FAIL');
        end;

        foreach Outcome in Outcomes do begin
            if JoinedOutcomes <> '' then
                JoinedOutcomes += '|';
            JoinedOutcomes += Outcome;
        end;

        RunLog.Init();
        RunLog.Outcomes := CopyStr(JoinedOutcomes, 1, MaxStrLen(RunLog.Outcomes));
        RunLog.Insert(true);
    end;
}