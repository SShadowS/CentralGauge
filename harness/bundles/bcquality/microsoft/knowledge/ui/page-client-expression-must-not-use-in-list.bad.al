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
            field("No."; Rec."No.") { }
            field(Status; Rec.Status) { }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Approve)
            {
                Caption = 'Approve';
                // AL0573: InListExpression is not valid for client expressions.
                Enabled = Rec.Status in [Rec.Status::New, Rec.Status::"Needs Review"];

                trigger OnAction()
                begin
                    Rec.Status := Rec.Status::Approved;
                    Rec.Modify(true);
                end;
            }
        }
    }
}
