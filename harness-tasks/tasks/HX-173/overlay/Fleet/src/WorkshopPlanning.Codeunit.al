codeunit 70161 "CGR Workshop Planning"
{
    procedure PlanWorkshopTask(VehicleNo: Code[20]; TaskType: Enum "CGR Workshop Task Type"; DamageEntryNo: Integer; Description: Text[100]): Integer
    var
        WorkshopTask: Record "CGR Workshop Task";
    begin
        WorkshopTask.Init();
        WorkshopTask."Vehicle No." := VehicleNo;
        WorkshopTask."Task Type" := TaskType;
        WorkshopTask."Damage Entry No." := DamageEntryNo;
        WorkshopTask.Description := Description;
        WorkshopTask."Planned On" := WorkDate();
        WorkshopTask.Insert(true);
        exit(WorkshopTask."Entry No.");
    end;

    procedure AcceptWorkshopProposal(var Proposal: Record "CGR Workshop Task" temporary): Integer
    var
        Planned: Integer;
    begin
        Proposal.Reset();
        if Proposal.FindSet() then
            repeat
                PlanWorkshopTask(Proposal."Vehicle No.", Proposal."Task Type", Proposal."Damage Entry No.", Proposal.Description);
                Planned += 1;
            until Proposal.Next() = 0;
        Proposal.DeleteAll();
        exit(Planned);
    end;

    procedure CompleteWorkshopTask(EntryNo: Integer)
    var
        WorkshopTask: Record "CGR Workshop Task";
    begin
        WorkshopTask.Get(EntryNo);
        WorkshopTask.Done := true;
        WorkshopTask.Modify(true);
    end;
}
