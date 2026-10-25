enum 50700 "Sample Request Status"
{
    Extensible = false;

    value(0; New) { Caption = 'New'; }
    value(1; "Needs Review") { Caption = 'Needs Review'; }
    value(2; Approved) { Caption = 'Approved'; }
}

table 50700 "Sample Request"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Status; Enum "Sample Request Status") { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}

page 50700 "Sample Request Card"
{
    PageType = Card;
    SourceTable = "Sample Request";
    ApplicationArea = All;

    layout
    {
        area(Content)
        {
            field("No."; Rec."No.")
            {
                // A plain field comparison is a valid client expression.
                Editable = Rec.Status = Rec.Status::New;
            }
            field(Status; Rec.Status)
            {
                trigger OnValidate()
                begin
                    UpdateActionStates();
                end;
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Approve)
            {
                Caption = 'Approve';
                // The list membership is computed in AL and exposed as a global Boolean.
                Enabled = ApproveEnabled;

                trigger OnAction()
                begin
                    Rec.Status := Rec.Status::Approved;
                    Rec.Modify(true);
                    UpdateActionStates();
                end;
            }
        }
    }

    var
        ApproveEnabled: Boolean;

    trigger OnAfterGetCurrRecord()
    begin
        UpdateActionStates();
    end;

    local procedure UpdateActionStates()
    begin
        ApproveEnabled := Rec.Status in [Rec.Status::New, Rec.Status::"Needs Review"];
    end;
}
