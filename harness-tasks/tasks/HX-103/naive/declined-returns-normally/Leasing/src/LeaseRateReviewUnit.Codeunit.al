codeunit 70351 "CGR Lease Rate Review Unit"
{
    TableNo = "CGR Lease Contract";

    var
        Accepted: Boolean;

    trigger OnRun()
    var
        LeaseRateReview: Codeunit "CGR Lease Rate Review";
    begin
        Accepted := false;
        Accepted := LeaseRateReview.ReviewLease(Rec."No.");
    end;

    procedure WasAccepted(): Boolean
    begin
        exit(Accepted);
    end;
}
