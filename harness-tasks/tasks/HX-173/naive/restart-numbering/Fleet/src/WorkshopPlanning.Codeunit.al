codeunit 70161 "CGR Workshop Planning"
{
    var
        ServiceDueTxt: Label 'Service due';

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

    procedure ProposeWorkshopTasks(VehicleNo: Code[20]; AtDate: Date; var Proposal: Record "CGR Workshop Task" temporary): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        Added: Integer;
    begin
        if ServicePlanMgt.IsServiceDue(VehicleNo, AtDate) then begin
            Added += 1;
            AddProposalLine(Proposal, Added, VehicleNo, "CGR Workshop Task Type"::Service, 0, ServiceDueTxt);
        end;
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.SetRange(Repaired, false);
        if DamageEntry.FindSet() then
            repeat
                Added += 1;
                AddProposalLine(Proposal, Added, VehicleNo, "CGR Workshop Task Type"::Repair, DamageEntry."Entry No.", DamageEntry.Description);
            until DamageEntry.Next() = 0;
        exit(Added);
    end;

    local procedure AddProposalLine(var Proposal: Record "CGR Workshop Task" temporary; LineNo: Integer; VehicleNo: Code[20]; TaskType: Enum "CGR Workshop Task Type"; DamageEntryNo: Integer; Description: Text[100])
    begin
        Proposal.Init();
        Proposal."Entry No." := LineNo;
        Proposal."Vehicle No." := VehicleNo;
        Proposal."Task Type" := TaskType;
        Proposal."Damage Entry No." := DamageEntryNo;
        Proposal.Description := Description;
        Proposal.Insert(true);
    end;
}
