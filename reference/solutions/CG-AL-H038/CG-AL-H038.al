codeunit 70380 "CG H038 Worker"
{
    Access = Public;
    SubType = Normal;
    TableNo = "CG H038 Job";

    trigger OnRun()
    begin
        Rec.Status := 'PROCESSING';
        Rec.Modify(true);

        if Rec.Marker = 'BAD' then
            Error('Worker rejected job %1', Rec.Code);

        Rec.Status := 'DONE';
        Rec.Modify(true);
    end;
}

codeunit 70381 "CG H038 Coordinator"
{
    Access = Public;

    procedure ProcessJob(JobCode: Code[20]) Succeeded: Boolean
    var
        Job: Record "CG H038 Job";
    begin
        Job.Get(JobCode);
        Succeeded := Codeunit.Run(Codeunit::"CG H038 Worker", Job);
    end;
}