page 50991 "CG Analyzer Canary"
{
    PageType = CardPart;

    layout
    {
        area(Content)
        {
            cuegroup(Cues)
            {
                field(Count; CountValue)
                {
                }

                actions
                {
                    action(Open)
                    {
                        trigger OnAction()
                        begin
                        end;
                    }
                }
            }
        }
    }

    var
        CountValue: Integer;
}
