codeunit 86442 "HX049 Partner Transport" implements "CGR Outbox Transport"
{
    var
        PartnerDownErr: Label 'HX049 partner down';

    procedure Send(Entry: Record "CGR Outbox Entry"): Boolean
    var
        Spy: Codeunit "HX049 Transport Spy";
    begin
        Spy.RecordCall(Entry."Entry No.");
        case Spy.Mode() of
            Spy.ErrorMode():
                Error(PartnerDownErr);
            Spy.RefuseMode():
                exit(false);
        end;
        exit(true);
    end;
}
