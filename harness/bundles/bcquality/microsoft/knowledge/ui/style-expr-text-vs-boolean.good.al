page 50214 "UI Sample StyleExpr"
{
    PageType = List;
    SourceTable = "Sales Header";

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field(Status; Rec.Status)
                {
                    ApplicationArea = All;
                    StyleExpr = StatusStyle;
                }
                field(Amount; Rec.Amount)
                {
                    ApplicationArea = All;
                    Style = Favorable;
                    StyleExpr = IsProfitable;
                }
            }
        }
    }

    trigger OnAfterGetRecord()
    begin
        case Rec.Status of
            Rec.Status::Open:
                StatusStyle := 'Standard';
            Rec.Status::Released:
                StatusStyle := 'Favorable';
        end;
        IsProfitable := Rec.Amount > 0;
    end;

    var
        StatusStyle: Text;
        IsProfitable: Boolean;
}
